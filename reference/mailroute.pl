#!/usr/bin/perl -w
#
# mailroute by Chris Garrigues <cwg@DeepEddy.Com>
#
# Reads an email message on stdin and pretty prints the contents of the
# recieved headers.
#
# When given an email message as it's argument will parse out the received
# headers and display the route it took to get to you and the times it
# arrived at each of the locations in your local timezone.
#
# It also tries to be clever in how it displays things:  (1) It only shows
# what changed in the date/time rather than the entire date/time each time. 
# (2) It breaks the line before the keywords "from", "by", and "with"
# unless they appear in comments.

# Changes by Mikko H�nninen <Mikko.Hanninen@iki.fi>
#
# - match non-numeric timezones, as well as more liberal number checking
# - allow for two digit years as well as four digits (actually, any number
#   of digits)
# - also display Delivered-To: lines amidst Received: information
# - timezone conversion works even with timezones like +0745
# - somewhat prettier output (split at by/with/from) for non-recognised
#   date lines
# - print time difference from first entry
# - print time different always, even if it's the same as previous time
#   (so you can see where each hop is)
# - added "id" and "for" to keywords before which a linebreak is added
# - print date information on a separate line, so there's no need to reserve
#   columns for it on every line
# - print malformed received lines (cannot parse date) "as-is" with no
#   offset


use Time::Local;

# Global variable for date parsing
%mon = ('jan' => 0,
	'feb' => 1,
	'mar' => 2,
	'apr' => 3,
	'may' => 4,
	'jun' => 5,
	'jul' => 6,
	'aug' => 7,
	'sep' => 8,
	'oct' => 9,
	'nov' => 10,
	'dec' => 11);

# Initialize some variables to keep -w quiet
($owd, $om, $od, $ot, $oy) = ("", "", "", "", "");


# Perl trim function to remove whitespace from the start and end of the string
sub trim($)
{
	my $string = shift;
	$string =~ s/^\s+//;
	$string =~ s/\s+$//;
	return $string;
}


# Read the headers into $_
($_ = "\n" . join("", <>)) =~ s/\n\n.*$//sg;

# Parse the contents of the received headers into an array
@rec = ();
while (/\n(received|delivered-to):(.*?)(\n\S)/gis) {
    unshift(@rec, "$1:$2");
#    print "Adding $1: $2\n";
    $_ = "$3$'";
}
#while (/\nreceived:(.*?)(\n\S)/gis) {
#    unshift(@rec, $1);
#    print "Adding Received: $1\n";
#    $_ = "$2$'";
#}


for (@rec) {
    if (/^delivered-to:/i) {
      s/^delivered-to://i;  # strip Delivered-To:
      s/\s+/ /gs;
      s/^\s+//;
      print "                   Delivered-To: $_\n";
    }
    else {
      s/^received://i;  # strip Received:
      s/\s+/ /gs;

      # Format is "information; date"
      ($line, $date) = /^\s*(.*?)\s*;\s*(.*?)$/;
      if (!$date) {
        # no date, must be malformed? simscan will produce these
        # just print it out and go to next
        print "                   ", trim($_), "\n";
        next;
      }

      $date =~ s/\(.*\)//g;
      $date =~ s/\s+/ /gs;
      # Parse the sucker
      if ($date =~ /(\d+) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec) (\d+) (\d+):(\d\d):(\d\d) ([+-]?\d+|\w+)/i) {
	# Coerce the date into something we can give to timegm
	$d = $1;
	($m = $2) =~ tr/A-Z/a-z/;
	$y = $3;
	$h = $4;
	$mi = $5;
	$s = $6;
	$tz = $7;
	if ($tz =~ /[+-]?\d+/) { ($zs, $zh, $zm) = $tz =~ /^([-+])(\d\d)(\d\d)$/; }
	  else { $zs = "+"; $zh = $zm = 0; }  # word tz def, assume GMT
	$m = $mon{$m};
	if ($y > 1900) { $y -= 1900; } elsif ($y < 70) { $y += 100; }  # Y2K fix
	if ($zs eq "+") { $zs = 1; } else { $zs = -1; }
        $ts = timegm($s, $mi, $h, $d, $m, $y) -
		     $zs * ($zh*60*60 + $zm*60);
	$begints = $ts unless ($begints);
	($wd, $m, $d, $t, $y) = split(' ', localtime($ts));
	$d = " $d" if ($d < 10);
	# Insert line breaks
	$line =~ s/\b(by|with|from|id|for)\b/\n                   $1/g;
	# But take them back out if they're in a comment
	while ($line =~ s/\(([^()]*?)\s\s+?(.*?)\)/\($1 $2\)/gs) {};
	$line =~ s/\( /\(/g;
	$line =~ s/^\s*//s;
	# Figure out what parts of the date we want to display
	($pwd, $pm, $pd, $pt, $py) = ($wd, $m, $d, $t, $y);
	$pwd = "" if ($wd eq $owd);
	$pm = "" if ($d eq $od);
	#$pm = "" if ($m eq $om);
	$pd = "" if ($d eq $od);
	$pt = "        " if ($t eq $ot);  # comment this out to always print time
	$py = "" if ($y eq $oy);
	$offs = $ts - $begints;
        if ($offs >= 0) { $off_sign = '+'; } else { $off_sign = '-'; $offs *= -1; }
	$off_s = $offs % 60;
	$off_m = int($offs / 60) % 60;
	$off_h = int($offs / 3600) % 24;
        if ($offs > 60*60*24) { $off_d = int($offs / (60*60*24)); } else { $off_d = ""; }
	$poffs = sprintf("%s%02d:%02d:%02d%s", $off_sign, $off_h, $off_m, $off_s, $off_d ? "+" . $off_d . "d" : "");
	print "$pwd $pd $pm $py\n" if ($py || $pm || $pd || $pwd);
	print "$pt $poffs $line\n";
	#print "$pwd $pm $pd $py $pt $poffs $line\n";
	($owd, $om, $od, $ot, $oy) = ($wd, $m, $d, $t, $y);
        #$prevts = $ts;

      } else {
	# bail...
	$date =~ s/\b(by|with|from|using|id|for)\b/\n                   $1/g;
	$line =~ s/\b(by|with|from|using|id|for)\b/\n                   $1/g;
	printf ("%17s  %s\n", $date, $line);
        #print "$date $line\n";
      }

    }
}

